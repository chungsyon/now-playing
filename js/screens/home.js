/**
 * HOME
 * ----
 * Start a slide, or pick up one you left in the tray.
 */

import {
  h, clear, icon, iconButton, segmented, emptyState, toast, largeTitle, sectionHead, section, footnote,
} from '../ui.js';
import { ASPECTS } from '../model.js';
import { listDrafts, deleteDraft, listStyles, deleteStyle } from '../db.js';

const RATIO_CHOICES = [
  { value: 'photo', label: 'Original' },
  ...ASPECTS.map(a => ({ value: a.id, label: a.label })),
  { value: 'custom', label: 'Custom' },
];

export async function enter(root, app) {
  clear(root);

  const preference = app.state.aspectPreference;

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    hidden: true,
    onchange: async event => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) await app.startWithPhoto(file);
    },
  });

  const customHeight = h('input', {
    class: 'input input--inline',
    type: 'number',
    min: '600',
    max: '1920',
    step: '10',
    inputmode: 'numeric',
    value: String(app.state.customHeight),
    id: 'custom-height',
    oninput: event => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) app.state.customHeight = value;
    },
  });

  const customBlock = h('div', { class: 'group', style: { marginTop: '8px' }, hidden: preference !== 'custom' },
    h('label', { class: 'row', for: 'custom-height' },
      h('span', { class: 'row__main' }, 'Height'),
      customHeight,
      h('span', { class: 'row__value' }, 'px'),
    ),
  );

  const shapeNote = footnote('');
  const describeShape = value => {
    shapeNote.textContent = value === 'photo'
      ? 'The slide takes the shape of your photo, so the two sit together in the carousel.'
      : value === 'custom' ? 'The width is always 1080 pixels.' : `1080 pixels wide, ${value}.`;
  };
  describeShape(preference);

  const ratioGroup = segmented(RATIO_CHOICES, preference, value => {
    app.state.aspectPreference = value;
    customBlock.hidden = value !== 'custom';
    ratioGroup.select(value);
    describeShape(value);
  }, 'Slide shape');

  const draftsBox = h('div', { class: 'group group--art' });
  const stylesBox = h('div', { class: 'group' });
  const trayLabel = sectionHead('Drafts', '');
  const stylesLabel = sectionHead('Your styles', '');

  root.append(
    h('div', { class: 'page' },
      largeTitle('Now Playing'),

      h('div', { class: 'hero' },
        h('div', { class: 'hero__art' }, icon('music-notes')),
        h('h2', { class: 'hero__title' }, 'Make a now playing slide'),
        h('p', { class: 'hero__text' },
          'The second slide of a carousel: silent, looping, and it shows a song is on.'),
        h('button', {
          class: 'btn btn--primary btn--block',
          type: 'button',
          onclick: () => fileInput.click(),
        }, icon('image'), 'Choose a Photo'),
        fileInput,
      ),

      section('Slide shape',
        ratioGroup,
        customBlock,
        shapeNote,
      ),

      section(trayLabel, draftsBox),
      section(stylesLabel, stylesBox),
    ),
  );

  await Promise.all([
    fillDrafts(draftsBox, app, trayLabel),
    fillStyles(stylesBox, app, stylesLabel),
  ]);
}

function setCount(label, n, word) {
  const value = label.querySelector('.section__value');
  if (value) value.textContent = n === 0 ? '' : `${n} ${word}`;
}

async function fillDrafts(box, app, label) {
  clear(box);
  let drafts = [];
  try {
    drafts = await listDrafts();
  } catch (error) {
    box.append(emptyState('Saved work could not be opened on this device.'));
    return;
  }

  setCount(label, drafts.length, drafts.length === 1 ? 'draft' : 'drafts');

  if (drafts.length === 0) {
    box.replaceWith(emptyState('No drafts yet. Your work saves here as you go.'));
    return;
  }

  for (const draft of drafts) {
    const frame = h('img', { class: 'art', alt: '' });
    if (draft.photo) {
      const url = URL.createObjectURL(draft.photo);
      frame.src = url;
      frame.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    }

    const open = h('button', {
      class: 'row',
      type: 'button',
      onclick: () => app.openDraft(draft.id),
    },
      frame,
      h('span', { class: 'row__main' },
        h('span', { class: 'row__title' }, draft.project.song.title || 'No song yet'),
        h('span', { class: 'row__sub' },
          `${draft.project.song.artist || 'Waiting for a song'} · ${when(draft.updatedAt)}`),
      ),
      h('span', { class: 'row__value' }, `${draft.project.loopSeconds.toFixed(0)}s`),
    );

    const remove = iconButton('trash', 'Discard this draft', async () => {
      await deleteDraft(draft.id);
      toast('Discarded.');
      await fillDrafts(box, app, label);
    });

    box.append(h('div', { class: 'row-wrap' }, open, remove));
  }
}

async function fillStyles(box, app, label) {
  clear(box);
  let styles = [];
  try {
    styles = await listStyles();
  } catch {
    styles = [];
  }

  setCount(label, styles.length, styles.length === 1 ? 'style' : 'styles');

  if (styles.length === 0) {
    box.replaceWith(emptyState('Save a look from the editor and it will wait here.'));
    return;
  }

  for (const style of styles) {
    const open = h('button', {
      class: 'row',
      type: 'button',
      onclick: () => app.startFromStyle(style),
    },
      h('span', { class: 'row__main' },
        h('span', { class: 'row__title' }, style.name),
        h('span', { class: 'row__sub' }, `${style.project.template} · ${when(style.updatedAt)}`),
      ),
    );
    const remove = iconButton('trash', `Remove the style ${style.name}`, async () => {
      await deleteStyle(style.id);
      await fillStyles(box, app, label);
    });
    box.append(h('div', { class: 'row-wrap' }, open, remove));
  }
}

function when(timestamp) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
