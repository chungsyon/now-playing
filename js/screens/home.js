/**
 * HOME
 * ----
 * Start a slide, or pick up one you left in the tray.
 */

import { h, clear, icon, iconButton, segmented, emptyState, toast, titleCard, bottle } from '../ui.js';
import { ASPECTS } from '../model.js';
import { listDrafts, deleteDraft, listStyles, deleteStyle } from '../db.js';

const RATIO_CHOICES = [
  { value: 'photo', label: 'Match photo' },
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
    class: 'input',
    type: 'number',
    min: '600',
    max: '1920',
    step: '10',
    value: String(app.state.customHeight),
    id: 'custom-height',
    oninput: event => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) app.state.customHeight = value;
    },
  });

  const customBlock = h('div', { class: 'field', hidden: preference !== 'custom' },
    h('label', { for: 'custom-height' }, 'Height in pixels. The width is always 1080.'),
    customHeight,
  );

  const ratioGroup = segmented(RATIO_CHOICES, preference, value => {
    app.state.aspectPreference = value;
    customBlock.hidden = value !== 'custom';
    ratioGroup.select(value);
  }, 'Slide shape');

  const draftsBox = h('div', { class: 'items' });
  const stylesBox = h('div', { class: 'items' });
  const trayLabel = bottle('Tray', '');
  const stylesLabel = bottle('Your styles', '');

  root.append(
    h('div', { class: 'stack stack--wide develops', style: { paddingTop: '26px' } },

      h('div', { class: 'stack' },
        titleCard('Now Playing'),
        h('p', { class: 'body', style: { marginTop: '6px' } },
          'Slide two of a carousel. Silent, looping, and it says a song is on.'),
      ),

      h('div', { class: 'stack' },
        h('button', {
          class: 'btn btn--primary btn--block',
          type: 'button',
          onclick: () => fileInput.click(),
        }, icon('image'), 'Start with a photo'),
        fileInput,
      ),

      h('div', { class: 'stack' },
        bottle('Shape'),
        ratioGroup,
        customBlock,
      ),

      h('div', { class: 'stack' },
        trayLabel,
        draftsBox,
      ),

      h('div', { class: 'stack' },
        stylesLabel,
        stylesBox,
      ),
    ),
  );

  await Promise.all([
    fillDrafts(draftsBox, app, trayLabel),
    fillStyles(stylesBox, app, stylesLabel),
  ]);
}

function setCount(label, n, word) {
  const value = label.querySelector('.bottle__value');
  if (value) value.textContent = n === 0 ? '' : `${String(n).padStart(2, '0')} ${word}`;
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

  setCount(label, drafts.length, drafts.length === 1 ? 'frame' : 'frames');

  if (drafts.length === 0) {
    box.append(emptyState('Nothing in the tray yet.'));
    return;
  }

  for (const draft of drafts) {
    const frame = h('img', { class: 'item__frame', alt: '' });
    if (draft.photo) {
      const url = URL.createObjectURL(draft.photo);
      frame.src = url;
      frame.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    }

    const open = h('button', {
      class: 'item',
      type: 'button',
      onclick: () => app.openDraft(draft.id),
    },
      frame,
      h('span', { class: 'item__main' },
        h('span', { class: 'item__title' }, draft.project.song.title || 'No song yet'),
        h('span', { class: 'item__sub' },
          `${draft.project.song.artist || 'Waiting for a song'}  /  ${when(draft.updatedAt)}`),
      ),
      h('span', { class: 'item__value' },
        `${draft.project.loopSeconds.toFixed(1)}s`),
    );

    const remove = iconButton('trash', 'Discard this draft', async () => {
      await deleteDraft(draft.id);
      toast('Discarded.');
      await fillDrafts(box, app, label);
    });

    box.append(h('div', { class: 'item-row' },
      h('div', { class: 'grow', style: { minWidth: '0' } }, open),
      remove,
    ));
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
    box.append(emptyState('Save a look from the editor and it will wait here.'));
    return;
  }

  for (const style of styles) {
    const open = h('button', {
      class: 'item',
      type: 'button',
      onclick: () => app.startFromStyle(style),
    },
      h('span', { class: 'item__main' },
        h('span', { class: 'item__title' }, style.name),
        h('span', { class: 'item__sub' }, `${style.project.template}  /  ${when(style.updatedAt)}`),
      ),
      icon('caret-right', { size: 'sm' }),
    );
    const remove = iconButton('trash', `Remove the style ${style.name}`, async () => {
      await deleteStyle(style.id);
      await fillStyles(box, app, label);
    });
    box.append(h('div', { class: 'item-row' },
      h('div', { class: 'grow', style: { minWidth: '0' } }, open),
      remove,
    ));
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
